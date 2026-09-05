// Pure view-model helpers for the Pagar.me branch of the admin workspace detail. No network,
// env or Supabase access in the helpers (same discipline as pricing.ts and
// _shared/pagarme-logic.ts) so the drift rules are unit-testable in isolation. The gateway port
// at the bottom is the only thing that touches the network, and buildSubscriptionDetail takes it
// by injection so tests substitute a fake.
//
// Spec: docs/superpowers/specs/2026-09-05-pagarme-admin-parity-design.md §1.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { mapPagarmeTemporalFields, normalizePagarmeStatus } from "../_shared/pagarme-logic.ts";

export interface PagarmeRemoteSubscription {
  id: string;
  /** 'future' | 'active' | 'canceled' | 'failed' | anything newer Pagar.me may add. */
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  canceled_at?: string | null;
  current_cycle?: {
    start_at?: string | null;
    end_at?: string | null;
    billing_at?: string | null;
    status?: string | null;
  } | null;
  card?: {
    brand?: string | null;
    first_six_digits?: string | null;
    last_four_digits?: string | null;
    /** The only number field the official subscription example shows, e.g. "424242******4242". */
    masked_number?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
  } | null;
}

export interface PagarmeLiveCard {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

export interface PagarmeDrift {
  /** Present only when the normalized live status differs from the mirror. */
  status: { mirror: string | null; live: string } | null;
  /** Present only when the live period end differs from the mirror by more than 24h. */
  period: { mirror: string | null; live: string } | null;
}

export type PagarmeLiveStatus = "trialing" | "active" | "canceled";

export interface PagarmeLive {
  /** Normalized with the webhook's table; null when the remote status is unknown to us. */
  status: PagarmeLiveStatus | null;
  remote_status: string;
  /** active: next_billing_at ?? current_cycle.billing_at; future: start_at; otherwise null. */
  next_billing_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  card: PagarmeLiveCard | null;
  /** null when nothing diverges. */
  drift: PagarmeDrift | null;
}

export interface PagarmeDetailGateway {
  /** GET /subscriptions/{id}. Throws PagarmeApiError / timeout / missing-key errors. */
  fetchSubscription(subId: string): Promise<PagarmeRemoteSubscription>;
}

/**
 * `${base}/subscriptions/${id}/info` (the Pagar.me dashboard's subscription page). Returns null
 * when the base is unset, not https, or the id is empty, so callers just omit the link.
 */
export function pagarmeDashboardUrl(
  base: string | null | undefined,
  subId: string,
): string | null {
  if (!base || !subId) return null;
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed)) return null;
  return `${trimmed}/subscriptions/${encodeURIComponent(subId)}/info`;
}

/**
 * Rule 1 of the spec. A remote `active` while the mirror is in a dunning episode (`past_due`)
 * is expected, not drift: only charge.paid closes the episode (see buildReconcileColumns in
 * pagarme-webhook/logic.ts). An unknown remote status (null) is displayed, never judged.
 */
export function statusDiffers(
  mirror: string | null,
  live: PagarmeLiveStatus | null,
): boolean {
  if (live == null) return false;
  if (mirror === live) return false;
  if (mirror === "past_due" && live === "active") return false;
  return true;
}

const PERIOD_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Rules 2 to 4 of the spec. A null remote period never flags (a canceled subscription has no
 * cycle and the mirror retains its paid-through date on purpose); a null mirror against a real
 * remote period does. Otherwise the two instants must be within 24h of each other, which
 * absorbs any date-only vs timestamp skew while still catching a real month/year change.
 */
export function periodDiffers(mirror: string | null, live: string | null): boolean {
  if (live == null) return false;
  if (mirror == null) return true;
  const a = parseMs(mirror);
  const b = parseMs(live);
  if (a == null || b == null) return true;
  return Math.abs(a - b) > PERIOD_TOLERANCE_MS;
}

function nextBilling(remote: PagarmeRemoteSubscription): string | null {
  if (remote.status === "active") {
    return remote.next_billing_at ?? remote.current_cycle?.billing_at ?? null;
  }
  if (remote.status === "future") return remote.start_at ?? null;
  return null;
}

/** Last four digits from a mask like "424242******4242"; null unless the tail is 4 digits. */
function last4FromMask(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const tail = masked.trim().slice(-4);
  return /^\d{4}$/.test(tail) ? tail : null;
}

/**
 * The subscription's card shape is not validated in this repo: the official example shows
 * holder_name/masked_number/exp_month/exp_year and NO brand or last_four_digits, while the
 * generic card object has brand + last_four_digits. Read both, prefer the explicit fields.
 */
function mapCard(card: PagarmeRemoteSubscription["card"]): PagarmeLiveCard | null {
  if (!card) return null;
  return {
    brand: card.brand ?? null,
    last4: card.last_four_digits ?? last4FromMask(card.masked_number),
    exp_month: typeof card.exp_month === "number" ? card.exp_month : null,
    exp_year: typeof card.exp_year === "number" ? card.exp_year : null,
  };
}

export function buildPagarmeLive(
  remote: PagarmeRemoteSubscription,
  mirror: { status: string | null; current_period_end: string | null },
): PagarmeLive {
  const status = normalizePagarmeStatus(remote.status);
  const livePeriod = mapPagarmeTemporalFields(remote).current_period_end;

  const statusDrift = status != null && statusDiffers(mirror.status, status)
    ? { mirror: mirror.status, live: status }
    : null;
  const periodDrift = livePeriod != null && periodDiffers(mirror.current_period_end, livePeriod)
    ? { mirror: mirror.current_period_end, live: livePeriod }
    : null;

  return {
    status,
    remote_status: remote.status,
    next_billing_at: nextBilling(remote),
    start_at: remote.start_at ?? null,
    canceled_at: remote.canceled_at ?? null,
    card: mapCard(remote.card),
    drift: statusDrift || periodDrift ? { status: statusDrift, period: periodDrift } : null,
  };
}

/** Real port. Same shape as pagarme-webhook/gateway.ts; the secret is only required at call time. */
export function createPagarmeDetailGateway(): PagarmeDetailGateway {
  return {
    fetchSubscription: (subId) =>
      pagarmeFetch<PagarmeRemoteSubscription>(
        "GET",
        `/subscriptions/${encodeURIComponent(subId)}`,
      ),
  };
}
